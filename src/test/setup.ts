// Only load DOM matchers when actually running in jsdom. The pure-function
// suites (deadline, letter-readiness, etc.) run under the node environment
// and don't need them — and on this sandbox jsdom transitively requires the
// native `canvas` binding which isn't installed, producing noisy unhandled
// errors. Guarding the import keeps the suite quiet and portable.
if (typeof window !== "undefined") {
  // Side-effect import: extends Vitest's `expect` with DOM matchers.
  // @ts-expect-error — package ships matchers via side-effect, no module type.
  await import("@testing-library/jest-dom");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
