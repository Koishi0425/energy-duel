import { useEffect, useRef, useState } from 'react';

interface Props { rtt?: number }
interface Metrics { fps: number; slowFrames: number; longTasks: number; heapMb?: number }

export function PerformancePanel({ rtt }: Props) {
  const [metrics, setMetrics] = useState<Metrics>({ fps: 0, slowFrames: 0, longTasks: 0 });
  const longTasks = useRef(0);
  useEffect(() => {
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => { longTasks.current += list.getEntries().length; });
      observer.observe({ entryTypes: ['longtask'] });
    } catch { /* unsupported browsers still report FPS */ }
    let frame = 0; let slowFrames = 0; let previous = performance.now(); let windowStart = previous; let raf = 0;
    const tick = (now: number) => {
      frame += 1; if (now - previous > 34) slowFrames += 1; previous = now;
      if (now - windowStart >= 1000) {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        setMetrics({ fps: Math.round(frame * 1000 / (now - windowStart)), slowFrames, longTasks: longTasks.current, heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : undefined });
        frame = 0; slowFrames = 0; windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
  }, []);
  return <aside className="performance-panel" aria-label="本地流畅度指标"><strong>PERF</strong><span>{metrics.fps} FPS</span><span>慢帧 {metrics.slowFrames}/s</span><span>长任务 {metrics.longTasks}</span><span>RTT {rtt ?? '—'} ms</span>{metrics.heapMb !== undefined && <span>堆 {metrics.heapMb} MB</span>}</aside>;
}
