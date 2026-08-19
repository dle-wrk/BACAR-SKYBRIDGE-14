import { useMemo } from 'react';

// Decorative stratosphere backdrop: drifting stars + horizon glow.
// Pure CSS/SVG, fixed behind everything.
export default function StarfieldBackground() {
  const stars = useMemo(
    () =>
      Array.from({ length: 70 }, () => ({
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: Math.random() * 2 + 0.5,
        delay: Math.random() * 4,
        dur: 2 + Math.random() * 3,
        opacity: 0.3 + Math.random() * 0.7,
      })),
    []
  );

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
      {/* horizon glow arc */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[160%] h-[40%] rounded-[50%]"
        style={{
          background: 'radial-gradient(ellipse at center bottom, hsl(32 95% 60% / 0.16), transparent 70%)',
        }}
      />
      {/* aurora hint */}
      <div
        className="absolute top-0 left-0 w-full h-[55%] opacity-30"
        style={{
          background:
            'linear-gradient(120deg, transparent 30%, hsl(152 76% 56% / 0.12) 50%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
    </div>
  );
}