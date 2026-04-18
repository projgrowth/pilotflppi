import { describe, it, expect } from "vitest";
import { gridCellToCenter } from "@/lib/pdf-utils";

/**
 * The grid is the load-bearing piece of pin placement. Every finding rides
 * on `gridCellToCenter(cell)` returning a sane percent — if this drifts,
 * every pin in the app drifts.
 */
describe("gridCellToCenter", () => {
  it("returns the center of A0 (top-left cell)", () => {
    const c = gridCellToCenter("A0");
    expect(c).toEqual({ x: 5, y: 5 });
  });

  it("returns the center of J9 (bottom-right cell)", () => {
    const c = gridCellToCenter("J9");
    expect(c).toEqual({ x: 95, y: 95 });
  });

  it("returns the center of E4 (mid-grid)", () => {
    const c = gridCellToCenter("E4");
    expect(c).toEqual({ x: 45, y: 45 });
  });

  it("is case-insensitive", () => {
    expect(gridCellToCenter("h7")).toEqual(gridCellToCenter("H7"));
  });

  it("returns null for invalid input", () => {
    expect(gridCellToCenter(undefined)).toBeNull();
    expect(gridCellToCenter("")).toBeNull();
    expect(gridCellToCenter("Z9")).toBeNull();   // row out of A-J
    expect(gridCellToCenter("A99")).toBeNull();  // col out of 0-9
    expect(gridCellToCenter("99")).toBeNull();   // missing row
    expect(gridCellToCenter("AB")).toBeNull();   // missing column digit
  });
});
