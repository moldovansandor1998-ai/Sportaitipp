'use client';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/client';

type Review = { payment_id: string; membership_id: string; plan_id: string; reason: string; created_at: string; paid_base: number | null; currency: string | null };
/** Read-only operational alert. Deliberately offers no grant, debit, refund or cancellation button. */
export default function OwnerCardReviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data: { session } } = await browserClient().auth.getSession();
        if (!session) return;
        const response = await fetch('/api/admin/billing/whop-reviews', { cache: 'no-store', signal: controller.signal,
          headers: { authorization: `Bearer ${session.access_token}` } });
        if (!response.ok) throw new Error('Review list unavailable');
        const data = await response.json();
        if (!controller.signal.aborted) setReviews(data.reviews);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  }, []);
  if (failed) return <p role="alert">A kártyás fizetések ellenőrzési listája most nem érhető el. Ez nem jelenti azt, hogy nincs függő fizetés.</p>;
  if (!reviews.length) return null;
  return <section className="card" role="alert">
    <h2>Kártyás fizetés: tulajdonosi intézkedés szükséges</h2>
    <p>Új értékesítés előtt ellenőrizd az alábbi Whop-bizonylatokat. Kedvezményes terhelésnél ellenőrizd a megígért kreditet és a díjakat, majd dönts a teljesítésről vagy jóváhagyott visszatérítésről. A rendszer nem utal vissza és nem von le automatikusan kreditet. Egy fizetési link többszöri használata több külön lemondandó előfizetést hozhat létre.</p>
    <ul>{reviews.map(review => <li key={review.payment_id}>
      {review.payment_id} · {review.membership_id} · {review.plan_id} · {review.reason}
      {review.paid_base !== null && <> · {review.paid_base} {review.currency?.toUpperCase()} adó előtt</>}
    </li>)}</ul>
    {reviews.length === 100 && <p>Az első 100 tétel látható; további tételek is lehetnek.</p>}
  </section>;
}
