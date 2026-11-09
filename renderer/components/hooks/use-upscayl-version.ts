import { useState, useEffect } from "react";

const useUpscaylVersion = () => {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let mounted=true;
    window.electron.getAppVersion().then(value=>{if(mounted)setVersion(value?.split(' ')[0] || '');}).catch(()=>{if(mounted)setVersion('');});
    return ()=>{mounted=false;};
  }, []);

  return version;
};

export default useUpscaylVersion;
