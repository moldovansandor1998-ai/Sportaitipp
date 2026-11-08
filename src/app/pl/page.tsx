import LandingPage from "@/components/marketing/LandingPage";
import { landingMetadata } from "@/lib/seo";
export const metadata = landingMetadata("pl");
export default function LocalizedHomePage() { return <LandingPage locale="pl" />; }
