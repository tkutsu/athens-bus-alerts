import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlapPlate } from "@/components/flap-plate";

function landing(container: HTMLElement) {
  return container.querySelector(".flap-leaf-landing");
}

describe("FlapPlate", () => {
  it("turns one flap for a new title and clears it once the flap lands", () => {
    const { container, rerender } = render(
      <FlapPlate detail="" detailValue={null} title="Heading for" />,
    );
    expect(container.querySelectorAll(".flap-leaf")).toHaveLength(0);

    rerender(<FlapPlate detail="300 meters" detailValue={300} title="ακροπολη" />);
    const leaves = container.querySelectorAll(".flap-leaf");
    expect([...leaves].map((leaf) => leaf.textContent)).toEqual([
      "Heading for",
      "ακροπολη300 meters",
    ]);
    // Until it lands, the bottom half still shows the old name.
    expect(container.querySelector(".flap-half-bottom")?.textContent).toBe("Heading for");

    // Its shading ends first, on the same element; the flap stays.
    fireEvent.animationEnd(landing(container)!, { animationName: "flap-shade" });
    expect(landing(container)).not.toBeNull();

    fireEvent.animationEnd(landing(container)!, { animationName: "flap-land" });
    expect(container.querySelectorAll(".flap-leaf")).toHaveLength(0);
    expect(container.querySelector(".flap-half-bottom")?.textContent).toBe("ακροπολη300 meters");
  });

  it("rolls only the changed digits, down as the distance falls, without a flap", () => {
    const { container, rerender } = render(
      <FlapPlate detail="300 meters" detailValue={300} title="ακροπολη" />,
    );
    expect(container.querySelectorAll(".flap-roll")).toHaveLength(0);

    rerender(<FlapPlate detail="290 meters" detailValue={290} title="ακροπολη" />);
    expect(container.querySelectorAll(".flap-leaf")).toHaveLength(0);
    const top = container.querySelector(".flap-half-top .flap-detail")!;
    expect(top.className).toContain("flap-roll-down");
    expect([...top.querySelectorAll(".flap-roll")].map((digit) => digit.textContent)).toEqual([
      "2",
      "9",
    ]);

    rerender(<FlapPlate detail="310 meters" detailValue={310} title="ακροπολη" />);
    expect(container.querySelector(".flap-half-top .flap-detail")!.className).toContain(
      "flap-roll-up",
    );
  });
});
