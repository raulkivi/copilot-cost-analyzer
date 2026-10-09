import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatTile } from "./StatTile.js";

describe("StatTile", () => {
  it("renders label, value and note as a labelled group", () => {
    render(<StatTile label="Failure rate" value="75%" note="3 of 4 known" alert />);

    const tile = screen.getByRole("group", { name: "Failure rate" });
    expect(tile).toHaveTextContent("75%");
    expect(tile).toHaveTextContent("3 of 4 known");
    expect(screen.getByText("75%")).toHaveClass("stat-tile-value--alert");
  });
});
