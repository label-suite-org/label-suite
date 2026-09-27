export function shouldDropOwnedDisposableRole(input: { createdByHarness: boolean }): boolean {
  return input.createdByHarness;
}
