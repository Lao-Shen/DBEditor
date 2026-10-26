import { useEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

/** Measures an element's content box and tracks resizes. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    // Fallback for environments where ResizeObserver delivery is throttled.
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return { ref, size };
}

/**
 * Trailing-edge debounce. Used so dragging the splitter or resizing the window
 * does not fire a query for every intermediate height.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
