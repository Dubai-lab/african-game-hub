// One Africa Life: what can be done inside one of the town's businesses (./HomeView.tsx shows its
// inside): at a cookshop a plate, at a clinic the nurse, at a bank or a mobile-money spot money
// changed; elsewhere, what the place is, its people at their work, a seat (more to do in it comes
// with the town's next steps).
import { useTranslation } from 'react-i18next'
import type { BusinessKind } from './city/business'
import type { TravelState } from './Journey'
import { PlacePanel } from './Street'

const DOES: Partial<Record<BusinessKind, 'cookshop' | 'clinic' | 'changer'>> = { restaurant: 'cookshop', clinic: 'clinic', bank: 'changer' }

export function BusinessPanel({ kind, name, cat, travel, homeCountry }: { kind: BusinessKind; name: string; cat?: string; travel: TravelState; homeCountry: 'LR' | 'GH' }) {
  const { t } = useTranslation()
  const does = DOES[kind]
  return (
    <div className="flex flex-col gap-2" data-testid={`oal-business-${kind}`}>
      <p className="text-sm text-muted">
        {name}
        {cat ? ` · ${t(`oal.city.cats.${cat}`, { defaultValue: '' })}` : ''}
      </p>
      {does ? <PlacePanel place={does} travel={travel} homeCountry={homeCountry} /> : <p className="border border-line bg-panel p-4 text-sm">{t(`oal.business.${kind}`)}</p>}
    </div>
  )
}
