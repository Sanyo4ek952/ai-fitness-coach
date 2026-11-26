import { useId } from "react";

type ExerciseIllustrationProps = Readonly<{ kind: "leg-press" | "pulldown" }>;

// Декоративные векторные иллюстрации: названия упражнений всегда даны текстом рядом.
export function ExerciseIllustration({ kind }: ExerciseIllustrationProps) {
  const gradient = useId();
  return (
    <svg className="exercise-illustration" viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="15" y1="15" x2="80" y2="90" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e9f8ff" /><stop offset=".42" stopColor="#9dd5ff" /><stop offset="1" stopColor="#269cff" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gradient})`} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
        {kind === "leg-press" ? <>
          <path d="M17 80H82M24 78L14 47M30 75L20 47M60 77L77 39M67 78L84 41" />
          <path d="M23 52L35 70H57L68 53" strokeWidth="5" />
          <circle cx="29" cy="27" r="6.5" fill="#122d59" />
          <path d="M27 41L39 59L52 51L67 57M29 40L24 45L36 65L51 57L63 62" fill="#1b73c4" />
          <path d="M34 44L43 50L54 46M68 47L72 38M77 39L84 41" />
        </> : <>
          <path d="M24 82V29M76 82V29M18 82H82M50 27V12M20 29L29 24H71L80 29" />
          <path d="M28 30L31 45L40 50M72 30L69 45L60 50" strokeWidth="5" />
          <circle cx="50" cy="44" r="6.5" fill="#17386b" />
          <path d="M40 54L39 66H61L60 54Q50 49 40 54Z" fill="#226da9" />
          <path d="M42 67V80M58 67V80M34 67H66M28 30L24 26M72 30L76 26" />
        </>}
      </g>
    </svg>
  );
}
