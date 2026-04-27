import { useEffect, useState } from "react";

interface LoadingScreenProps {
  progress: number;
}

function LoadingScreen({ progress }: LoadingScreenProps) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (progress >= 100) {
      setFading(true);
    }
  }, [progress]);

  return (
    <div
      className={`fixed inset-0 flex flex-col items-center justify-center bg-[#2e1065] z-[100] ${
        fading ? "opacity-0 transition-opacity duration-500" : ""
      }`}
    >
      <h1 className="font-semibold text-4xl tracking-wide bg-gradient-to-r from-purple-100 via-indigo-200 to-purple-200 bg-clip-text text-transparent mb-12">
        Elizabeth
      </h1>
      
      <div className="w-64 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${progress}%`,
            background: "linear-gradient(to right, #8b5cf6, #a78bfa)",
          }}
        />
      </div>
      
      <p className="text-purple-300/60 text-sm mt-4">
        {progress < 100 ? "Loading..." : "Ready"}
      </p>
    </div>
  );
}

export default LoadingScreen;