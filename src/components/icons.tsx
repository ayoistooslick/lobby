import type { SVGProps } from "react";

/**
 * A tiny hand-rolled icon set: 24px grid, 1.75px strokes, currentColor.
 * Every icon is presentational. Screens provide their own labels.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconQueue(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h10M4 12h7M4 18h10" />
      <path d="M18 4v10m0 0-3-3m3 3 3-3" />
    </Icon>
  );
}

export function IconQr(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17.5 17.5H20V20h-2.5z" />
    </Icon>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5S13.9 16 14.5 19" />
      <path d="M15.5 5.4a3.25 3.25 0 0 1 0 5.2M17.5 14.9c1.7.6 2.7 1.9 3 4.1" />
    </Icon>
  );
}

export function IconUserCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5 1.2 0 2.3.26 3.2.76" />
      <path d="m15 17.5 2 2 4-4.5" />
    </Icon>
  );
}

export function IconTv(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5.5" width="18" height="12" rx="1.5" />
      <path d="M9 21h6" />
    </Icon>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 1.8" />
    </Icon>
  );
}

export function IconPause(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5.5v13M15 5.5v13" />
    </Icon>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5.5 18.5 12 8 18.5Z" />
    </Icon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </Icon>
  );
}

export function IconArrow(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h15m0 0-5.5-5.5M19 12l-5.5 5.5" />
    </Icon>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 5 6v6c0 4.6 3 7.6 7 8.5 4-.9 7-3.9 7-8.5V6Z" />
      <path d="m9 11.8 2.2 2.2 4-4.5" />
    </Icon>
  );
}

export function IconChart(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 19.5h16" />
      <path d="M7 19.5v-6M12 19.5V8M17 19.5v-9" />
    </Icon>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h9m4 0h3M4 17h3m4 0h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Icon>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 17.5h2" />
    </Icon>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </Icon>
  );
}

export function IconFullscreen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </Icon>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12a7.5 7.5 0 0 1 13-5.2L20 9M20 4.5V9h-4.5" />
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.2L4 15M4 19.5V15h4.5" />
    </Icon>
  );
}

export function IconWifi(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9.5a12 12 0 0 1 16 0M6.8 13a8 8 0 0 1 10.4 0M9.7 16.4a4 4 0 0 1 4.6 0" />
      <path d="M12 19.5v.01" />
    </Icon>
  );
}
