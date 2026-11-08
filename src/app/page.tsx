import LandingPage from "@/components/marketing/LandingPage";
import { landingMetadata } from "@/lib/seo";
export const metadata = landingMetadata("en");
export default function HomePage() { return <LandingPage locale="en" />; }
