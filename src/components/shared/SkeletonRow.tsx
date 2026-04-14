import { cn } from "@/lib/utils";

interface SkeletonRowProps {
  cols: number;
  height?: number;
  className?: string;
}

export default function SkeletonRow({ cols, height = 16, className }: SkeletonRowProps) {
  return (
    <div className={cn("flex items-center gap-4 px-5 py-3", className)}>
      {Array.from({ length: cols }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded animate-pulse"
          style={{
            height,
            background: "linear-gradient(90deg, hsl(var(--fpp-gray-100)) 25%, hsl(var(--fpp-white)) 50%, hsl(var(--fpp-gray-100)) 75%)",
            backgroundSize: "200% 100%",
          }}
        />
      ))}
    </div>
  );
}
