import MomentsClient from "./moments/moments-client";
import { loadMomentsFeedProps } from "./moments/load-moments-feed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const props = await loadMomentsFeedProps();
  return <MomentsClient {...props} variant="home" />;
}
