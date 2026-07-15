import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Button } from 'antd';

interface FloatingWindowProps {
  storageId: string;
  title: string;
  children: ReactNode;
  onClose?: () => void;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  className?: string;
  inlineOnMobile?: boolean;
}

interface WindowGeometry { x: number; y: number; width: number; height: number }

export default function FloatingWindow({ storageId, title, children, onClose, initialPosition = { x: 120, y: 110 }, initialSize = { width: 360, height: 300 }, className = '', inlineOnMobile = false }: FloatingWindowProps) {
  const storageKey = `energy-duel-floating-window-${storageId}`;
  const [geometry, setGeometry] = useState<WindowGeometry>(() => loadGeometry(storageKey, initialPosition, initialSize));
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const windowRef = useRef<HTMLElement>(null);

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(geometry)); }, [geometry, storageKey]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setCompactLayout(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const clampToViewport = () => setGeometry((current) => clampGeometry(current));
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);
  useEffect(() => {
    const element = windowRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect();
      const width = Math.round(bounds.width);
      const height = Math.round(bounds.height);
      if (Math.abs(width - geometry.width) > 1 || Math.abs(height - geometry.height) > 1) {
        setGeometry((current) => ({ ...current, width, height }));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [geometry.height, geometry.width]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia('(max-width: 900px)').matches) return;
    const offsetX = event.clientX - geometry.x;
    const offsetY = event.clientY - geometry.y;
    const move = (pointer: PointerEvent) => setGeometry((current) => ({
      ...current,
      x: Math.max(8, Math.min(window.innerWidth - current.width - 8, pointer.clientX - offsetX)),
      y: Math.max(8, Math.min(window.innerHeight - 52, pointer.clientY - offsetY)),
    }));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); event.preventDefault();
  };

  if (inlineOnMobile && compactLayout) return <section className={`inline-floating-window ${className}`.trim()}><header><strong>{title}</strong>{onClose && <Button type="text" size="small" onClick={onClose}>收回</Button>}</header><div>{children}</div></section>;

  return createPortal(<section ref={windowRef} className={`floating-window ${className}`.trim()} style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }}>
    <header className="floating-window-titlebar" onPointerDown={beginDrag}><strong>{title}</strong>{onClose && <Button type="text" size="small" aria-label={`关闭${title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onClose}>×</Button>}</header>
    <div className="floating-window-body">{children}</div>
  </section>, document.body);
}

function loadGeometry(key: string, position: { x: number; y: number }, size: { width: number; height: number }): WindowGeometry {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '') as Partial<WindowGeometry>;
    if ([parsed.x, parsed.y, parsed.width, parsed.height].every((value) => typeof value === 'number')) return clampGeometry(parsed as WindowGeometry);
  } catch { /* use defaults */ }
  return clampGeometry({ ...position, ...size });
}

function clampGeometry(geometry: WindowGeometry): WindowGeometry {
  const width = Math.min(Math.max(270, geometry.width), Math.max(270, window.innerWidth - 16));
  const height = Math.min(Math.max(180, geometry.height), Math.max(180, window.innerHeight - 16));
  return {
    width,
    height,
    x: Math.max(8, Math.min(window.innerWidth - width - 8, geometry.x)),
    y: Math.max(8, Math.min(window.innerHeight - 52, geometry.y)),
  };
}
