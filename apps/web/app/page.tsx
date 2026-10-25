import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/features/landing/hero";
import { HowItWorks } from "@/features/landing/how-it-works";
import { CatchSection } from "@/features/landing/catch-carousel";
import { Money } from "@/features/landing/money";
import { ConnectAgent } from "@/features/landing/connect-agent";
import { Footer } from "@/features/landing/footer";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <HowItWorks />
        <CatchSection />
        <Money />
        <ConnectAgent />
      </main>
      <Footer />
    </>
  );
}
