import React, { useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";

type ChartContainerProps = {
  children: React.ReactNode;
  className?: string;
  containerRef?: (node: HTMLDivElement | null) => void;
};

const ChartContainer: React.FC<ChartContainerProps> = ({
  children,
  className = "h-full min-w-0",
  containerRef,
}) => {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const element = localRef.current;
    containerRef?.(element);

    if (!element) return undefined;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setIsReady(rect.width > 0 && rect.height > 0);
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      containerRef?.(null);
    };
  }, [containerRef]);

  return (
    <div ref={localRef} className={className}>
      {isReady ? (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      ) : (
        <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 text-sm text-amber-700 dark:border-white/10 dark:bg-white/5 dark:text-amber-300">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
            Loading chart...
          </div>
        </div>
      )}
    </div>
  );
};

export default ChartContainer;
