import LandingPage from "@/components/marketing/LandingPage";
import { landingMetadata } from "@/lib/seo";
export const metadata = landingMetadata("hu");
export default function HungarianHomePage() { return <LandingPage locale="hu" />; }
