const P = {
  play: 'M6 4l10 6-10 6z',
  pause: 'M6.5 4v12M13.5 4v12',
  stop: 'M5 5h10v10H5z',
  loop: 'M4 9V8a3 3 0 013-3h8l-2-2M16 11v1a3 3 0 01-3 3H5l2 2',
  key: 'M10 3l6 7-6 7-6-7z',
  plus: 'M10 4v12M4 10h12',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10',
  undo: 'M7 5L3 9l4 4M3 9h8a4 4 0 010 8H8',
  redo: 'M13 5l4 4-4 4M17 9H9a4 4 0 000 8h3',
  help: 'M10 17a7 7 0 100-14 7 7 0 000 14zM8 8a2 2 0 114 0c0 1.5-2 1.5-2 3M10 14h.01',
  camera: 'M3 7h3l1.5-2h5L14 7h3v9H3zM10 14a3 3 0 100-6 3 3 0 000 6z',
  right: 'M8 5l5 5-5 5',
  down: 'M5 8l5 5 5-5',
  mannequin: 'M10 6a2 2 0 100-4 2 2 0 000 4zM6 9h8M10 8v5M7 17l3-4 3 4',
  cube: 'M10 3l6 3v8l-6 3-6-3V6zM4 6l6 3 6-3M10 9v8',
  sphere: 'M10 17a7 7 0 100-14 7 7 0 000 14zM3 10c0 1.5 3 2.5 7 2.5s7-1 7-2.5',
  cylinder: 'M4 5c0-1 2.7-2 6-2s6 1 6 2-2.7 2-6 2-6-1-6-2zM4 5v10c0 1 2.7 2 6 2s6-1 6-2V5',
  joint: 'M10 13a3 3 0 100-6 3 3 0 000 6z',
  film: 'M4 4h12v12H4zM4 8h12M4 12h12M8 4v12M12 4v12',
  onion: 'M10 4a6 6 0 100 12 6 6 0 000-12zM13 5.5a6 6 0 010 9M7 5.5a6 6 0 000 9',
  menu: 'M4 6h12M4 10h12M4 14h12',
  sidebar: 'M4 4h12v12H4zM8 4v12',
  sidebarR: 'M4 4h12v12H4zM12 4v12',
  dance: 'M10 3a2 2 0 100 4 2 2 0 000-4zM4 9l6-1 6 1M10 8v5M7 17l3-4 3 4',
  upload: 'M10 13V4M6 8l4-4 4 4M4 16h12',
  close: 'M5 5l10 10M15 5L5 15',
  zoom: 'M9 15a6 6 0 100-12 6 6 0 000 12zM13.5 13.5L17 17M9 6.5v5M6.5 9h5',
  users: 'M7 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM13.5 9a2 2 0 100-4 2 2 0 000 4zM2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M12 12.2c.5-.2 1-.2 1.5-.2 2 0 4 1 4 3.5',
  cam: 'M3 6h9v8H3zM12 9l5-3v8l-5-3',
  image: 'M3.5 4h13v12h-13zM3.5 14l4-4 3 3 2-2 4 4M13 8a1 1 0 100-2 1 1 0 000 2z',
  logo: 'M10 3a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM5 11h10M10 8v5M7 17l3-4 3 4',
} as const;

export type IconName = keyof typeof P;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
