/**
 * A front-on bus whose windscreen is a pair of eyes. Moods swap the eyes by
 * class: closed when asleep, and squeezed shut or happy while pulling in.
 */
export function BusFace() {
  return (
    <svg aria-hidden="true" className="bus-face" viewBox="0 0 24 24">
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <rect height="18" rx="3.8" width="18.8" x="2.6" y="1.8" />
        <path d="M6.5 22.2V20M17.5 22.2V20" />
      </g>
      <g className="bus-face-eyes">
        {[8.5, 15.5].map((cx) => (
          <g className="bus-face-eye" key={cx}>
            <ellipse cx={cx} cy="9.2" fill="currentColor" rx="3.25" ry="3.75" />
            <circle className="bus-face-pupil bus-face-gaze" cx={cx} cy="9.2" r="1.82" />
          </g>
        ))}
      </g>
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <path
          className="bus-face-asleep"
          d="M5.1 9q3.4 3.5 6.8 0M12.1 9q3.4 3.5 6.8 0"
          strokeWidth="1.5"
        />
        <path className="bus-face-happy" d="M5.6 10.6q2.9-3.6 5.8 0M12.6 10.6q2.9-3.6 5.8 0" />
        <path className="bus-face-squeeze" d="M6.2 7.3l3.6 2-3.6 2M17.8 7.3l-3.6 2 3.6 2" />
      </g>
      <circle cx="6.9" cy="16.3" fill="currentColor" r="1" />
      <circle cx="17.1" cy="16.3" fill="currentColor" r="1" />
    </svg>
  );
}
