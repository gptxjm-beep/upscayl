import { useEffect, useState } from "react";

const useSystemInfo = () => {
  const [systemInfo, setSystemInfo] = useState<Awaited<
    ReturnType<typeof window.electron.getSystemInfo>
  > | null>(null);

  useEffect(() => {
    const getSystemInfo = async () => {
      try { setSystemInfo(await window.electron.getSystemInfo()); } catch { setSystemInfo(null); }
    };
    getSystemInfo();
  }, []);
  return { systemInfo };
};

export default useSystemInfo;
