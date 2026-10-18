# Public Image Response Implementation Plan

**Goal:** Ensure public image fields never expose raw CloudBase file IDs to browser or mini-program views.

**Architecture:** Add a global Nest response interceptor backed by the existing object storage URL cache. Keep storage values unchanged and add a mini-program component fallback for legacy `cloud://` values.

1. Add failing unit tests for recursive public-image response conversion.
2. Implement the recursive transformer and global Nest interceptor.
3. Register the interceptor through `StorageModule` and test application wiring.
4. Add a failing mini-program integration contract for CloudBase-aware component caching.
5. Switch `entity-artwork` to `cacheImageSource` for HTTP and CloudBase sources.
6. Run focused tests, API/miniprogram type checks, complete API tests, and inspect the final diff.
