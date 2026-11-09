"use client";
import Link from 'next/link';
import Image from 'next/image';
import { useAppTranslation } from '@/components/i18n/AppLanguageProvider';
import { studioCopy } from '@/lib/studio-copy';
import { Icon } from '@/components/marketing/Artwork';
export default function CustomerDashboard() {
  const { t, locale } = useAppTranslation();
  const c = studioCopy[locale];
  const cards = [
    { href: '/characters/new', title: t('Saját karakter'), body: t('Indulj új AI-karakterrel vagy saját, jóváhagyott referenciákkal.'), photo: 'image-generation', icon: 'spark' as const },
    { href: '/tools', title: c.video, body: t('Válaszd ki a modelledet, és készíts képeket, videókat.'), photo: 'video-motion', icon: 'arrow' as const },
    { href: '/gallery', title: t('Saját galéria'), body: t('Nézd meg, töltsd le és szerkeszd tovább az alkotásaidat.'), photo: 'creative-library', icon: 'grid' as const },
  ];
  return <main className="customer-dashboard">
    <section className="studio-welcome">
      <div className="studio-welcome-copy"><p className="customer-eyebrow">{c.studio}</p><h1>{t('Mit alkotsz ma?')}</h1><p>{t('Készíts saját karaktert, keltsd életre az ötleteidet, és tartsd egy helyen az alkotásaidat.')}</p><Link className="studio-primary" href="/generate">{t('Új alkotás')}<Icon name="arrow" /></Link></div>
      <div className="studio-welcome-art" aria-hidden="true"><Image src="/images/feature-photos/video-motion.png" alt="" fill priority sizes="(max-width: 700px) 100vw, 500px" /><span>START AI CREATOR <Icon name="spark" /></span></div>
    </section>
    <div className="studio-quicklinks"><Link href="/jobs"><span className="studio-live-dot" />{t('Generálások állapota')}<Icon name="arrow" /></Link><Link href="/plans"><span>◈</span>{t('Kreditek és csomagok')}<Icon name="arrow" /></Link></div>
    <div className="studio-section-heading"><div><p className="customer-eyebrow">{c.prepared}</p><h2>{c.tools}</h2></div><Link href="/tools">{t('AI-eszközök')} →</Link></div>
    <div className="studio-card-grid">{cards.map((card, index) => <Link className="studio-tool-card" href={card.href} key={card.href}><div className="studio-card-art"><Image src={`/images/feature-photos/${card.photo}.png`} alt="" fill sizes="(max-width: 700px) 90vw, 400px" /><span>0{index + 1}</span></div><div className="studio-card-copy"><h2>{card.title}<Icon name={card.icon} /></h2><p>{card.body}</p></div></Link>)}</div>
    <div className="studio-private-note"><Icon name="check" /><span>{c.privacy}</span></div>
  </main>;
}
