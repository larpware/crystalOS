import { useEffect, useState } from "react";
import { readNetwork, subscribeNetwork, type NetworkStatus } from "@/services/system";

/** Live browser connectivity. Values are exactly what the browser reports. */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => readNetwork());

  useEffect(() => {
    const update = () => setStatus(readNetwork());
    update();
    return subscribeNetwork(update);
  }, []);

  return status;
}
