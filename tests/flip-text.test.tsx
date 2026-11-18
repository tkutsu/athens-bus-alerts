import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlipText } from "@/components/flip-text";

describe("FlipText", () => {
  it("turns the old title away and the new one in, then drops the old one", () => {
    const { container, rerender } = render(
      <FlipText detail="" detailValue={null} title="Heading for" />,
    );
    expect(container.querySelector(".flip-in")).toBeNull();

    rerender(<FlipText detail="300 meters" detailValue={300} title="ακροπολη" />);
    const leaving = container.querySelector(".flip-out")!;
    expect(leaving.textContent).toBe("Heading for");
    expect(container.querySelector(".flip-in")?.textContent).toBe("ακροπολη·300 meters");

    fireEvent.animationEnd(leaving);
    expect(container.querySelector(".flip-out")).toBeNull();
    expect(container.querySelectorAll(".flip-face")).toHaveLength(1);
  });

  it("rolls only the changed digits, down as the distance falls, without a turn", () => {
    const { container, rerender } = render(
      <FlipText detail="300 meters" detailValue={300} title="ακροπολη" />,
    );
    expect(container.querySelectorAll(".flip-roll")).toHaveLength(0);

    rerender(<FlipText detail="290 meters" detailValue={290} title="ακροπολη" />);
    expect(container.querySelector(".flip-out")).toBeNull();
    const digits = container.querySelector(".flip-roll-down")!;
    expect([...digits.querySelectorAll(".flip-roll")].map((digit) => digit.textContent)).toEqual([
      "2",
      "9",
    ]);

    rerender(<FlipText detail="310 meters" detailValue={310} title="ακροπολη" />);
    expect(container.querySelector(".flip-roll-up")).not.toBeNull();
  });
});
