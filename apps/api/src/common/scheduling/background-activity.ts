/** Keep polling across a mutation's transaction commit, including an empty read
 * racing with that commit. This exceeds Prisma's 60-second transaction timeout.
 * A rolled-back mutation only causes bounded extra reads, never cached state.
 */
export class BackgroundActivity {
  private awakeUntil = 0;

  wake(): void {
    this.awakeUntil = Date.now() + 120_000;
  }

  isAwake(): boolean {
    return Date.now() < this.awakeUntil;
  }
}
