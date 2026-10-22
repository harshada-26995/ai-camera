import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);
export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);
export const IconZoomIn = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
  </Svg>
);
export const IconZoomOut = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M8 11h6" />
  </Svg>
);
export const IconFit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const IconCompare = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 2v20" />
  </Svg>
);
export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);
export const IconReset = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);
export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);
export const IconRotateLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4v5h5" />
    <path d="M4.6 15A8 8 0 1 0 6 6.3L4 9" />
  </Svg>
);
export const IconRotateRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 4v5h-5" />
    <path d="M19.4 15A8 8 0 1 1 18 6.3L20 9" />
  </Svg>
);
export const IconBrush = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z" />
    <path d="M9 12.5c-2 0-3.5 1.5-3.5 3.5 0 1.4-.8 2.5-2.5 3 1 .7 2.4 1 3.5 1 2.8 0 5-2 5-4.5" />
  </Svg>
);
export const IconEraser = (p: IconProps) => (
  <Svg {...p}>
    <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4L13.3 4.7a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21" />
    <path d="M7 21h14M9 11l6 6" />
  </Svg>
);
export const IconRestore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 9.5V12l1.5 1.5" />
  </Svg>
);
export const IconWand = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 21 12-12M14 4l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM19 11l.5-1 .5 1 1 .5-1 .5-.5 1-.5-1-1-.5zM8 4l.5-1 .5 1 1 .5-1 .5L8.5 6 8 5l-1-.5z" />
  </Svg>
);
export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);
export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </Svg>
);
export const IconMove = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
  </Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
  </Svg>
);
export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const IconShirt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3c0 1.7-1.8 3-4 3S8 4.7 8 3z" />
  </Svg>
);
export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Svg>
);
export const IconFlip = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <path d="M9 13.5a3 3 0 0 1 5.2-2M15 13.5a3 3 0 0 1-5.2 2" />
    <path d="M14.5 9.8v1.9h-1.9M9.5 17.2v-1.9h1.9" />
  </Svg>
);
