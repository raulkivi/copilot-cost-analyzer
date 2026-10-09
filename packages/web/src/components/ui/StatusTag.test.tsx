import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusTag } from "./StatusTag.js";

describe("StatusTag", () => {
  it("shows icon, status and category — never colour alone", () => {
    render(<StatusTag outcome={{ status: "error", failureCategory: "command-not-found", exitCode: 127 }} />);
    expect(screen.getByText(/Failed · Command not found/)).toBeInTheDocument();
    expect(screen.getByText("✕")).toBeInTheDocument();
  });

  it("explains an unknown outcome in its title", () => {
    render(<StatusTag outcome={{ status: "unknown", reason: "no result" }} />);
    expect(screen.getByTitle("no result")).toHaveTextContent("Unknown");
  });

  it("treats a missing outcome as unknown", () => {
    render(<StatusTag />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
