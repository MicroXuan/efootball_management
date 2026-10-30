import io
import pytest
from test_runtime import make_runtime
from efm_wechat_bridge.runtime import StructuredLogger
from efm_wechat_bridge.wechatauto_receiver import WechatautoReceiver


def test_session_failure_is_not_an_empty_success():
    class DB:
        def get_sessions(self, **kw):
            raise PermissionError('private path')
    receiver = WechatautoReceiver(database=DB(), enabled_group_ids=[], robot_user_id='robot')
    with pytest.raises(RuntimeError, match='WECHAT_SESSION_READ_FAILED'):
        receiver.poll(None)
    assert receiver.scanned_cursors() == {}


def test_recovery_rejects_different_account_and_preserves_cursor():
    class DB:
        def get_self_info(self):
            return {'username': 'other'}
    receiver = WechatautoReceiver(database=object(), database_factory=DB, enabled_group_ids=[], robot_user_id='robot')
    receiver._scanned_cursors = {'chat': 23}
    with pytest.raises(RuntimeError, match='WECHAT_ACCOUNT_CHANGED'):
        receiver.recover()
    assert receiver.scanned_cursors() == {'chat': 23}


def test_poll_failure_recovers_with_backoff_and_logs_no_exception_text(tmp_path, monkeypatch):
    runtime, transport, api, spool = make_runtime(tmp_path)
    stream = io.StringIO()
    runtime.logger = StructuredLogger(stream=stream)
    clock = [100.0]
    monkeypatch.setattr('efm_wechat_bridge.runtime.time.monotonic', lambda: clock[0])
    calls = []
    transport.recover = lambda: calls.append(True)
    def fail(_):
        raise PermissionError('secret message')
    original = transport.poll
    transport.poll = fail
    for _ in range(5):
        runtime.receive_upload_once()
    assert len(calls) == 1
    assert 'secret message' not in stream.getvalue()
    assert 'receiver_recovery_started' in stream.getvalue()
    assert runtime._receiver_status['status'] == 'RECOVERING'
    transport.poll = original
    runtime.receive_upload_once()
    assert runtime._receiver_status['status'] == 'HEALTHY'
    assert runtime._receiver_status['lastSuccessAt']
    assert 'receiver_recovered' in stream.getvalue()
    # SQLite connections are scoped per operation.


def test_group_snapshot_failure_does_not_stop_heartbeat(tmp_path):
    runtime, transport, api, spool = make_runtime(tmp_path)
    def fail():
        raise PermissionError('private path')
    transport.observed_groups = fail
    assert runtime.heartbeat_once()
    assert api.heartbeats[-1]['observedGroupsComplete'] is False
    assert api.heartbeats[-1]['receiverHealth']['errorCode'] == 'WECHAT_GROUP_READ_FAILED'
    # SQLite connections are scoped per operation.


def test_process_lock_rejects_duplicate_and_releases(tmp_path):
    from efm_wechat_bridge.process_lock import bridge_process_lock
    path = tmp_path / 'bridge.lock'
    with bridge_process_lock(path):
        with pytest.raises(RuntimeError, match='BRIDGE_ALREADY_RUNNING'):
            with bridge_process_lock(path):
                pass
    with bridge_process_lock(path):
        pass


def test_rotating_logs_keep_safe_fields(tmp_path):
    logger = StructuredLogger(stream=io.StringIO(), log_dir=tmp_path)
    logger.emit('receiver_unhealthy', code='WECHAT_DATABASE_UNAVAILABLE', token='secret', text='private')
    contents = (tmp_path / 'bridge.jsonl').read_text()
    assert 'WECHAT_DATABASE_UNAVAILABLE' in contents
    assert 'secret' not in contents
    assert 'private' not in contents


def test_upload_failure_keeps_pending_messages_and_recovers_once(tmp_path):
    from test_runtime import inbound
    from efm_wechat_bridge.api_client import BridgeApiError
    runtime, transport, api, spool = make_runtime(tmp_path)
    spool.append_inbound(inbound(), sort_key='0001')
    api.upload_error = BridgeApiError('BRIDGE_API_HTTP_503', terminal=False)
    assert runtime.receive_upload_once() == 0
    assert len(spool.pending_inbound(limit=10)) == 1
    assert runtime._receiver_status['status'] == 'RECOVERING'
    api.upload_error = None
    assert runtime.receive_upload_once() == 1
    assert runtime.receive_upload_once() == 0
    assert len(api.uploads) == 1
    assert runtime._receiver_status['status'] == 'HEALTHY'


def test_recovery_success_preserves_cursors():
    class DB:
        def get_self_info(self):
            return {'username': 'robot'}
    receiver = WechatautoReceiver(database=object(), database_factory=DB, enabled_group_ids=[], robot_user_id='robot')
    receiver._scanned_cursors = {'chat': 23}
    receiver.recover()
    assert receiver.health().database_available
    assert receiver.scanned_cursors() == {'chat': 23}


def test_health_probe_exception_does_not_kill_workers_or_claim_send(tmp_path):
    runtime, transport, api, spool = make_runtime(tmp_path, enable_send=True)
    assert runtime.doctor().passed
    def fail():
        raise OSError('private details')
    transport.health = fail
    assert runtime.send_once() == 0
    assert api.claims == 0
    assert runtime.upload_members_once() == 0
    assert runtime.receive_upload_once() == 0
    assert not runtime._stop.is_set()
