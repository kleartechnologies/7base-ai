import { TrendingUp } from 'lucide-react'
import { PlaceholderPage } from './PlaceholderPage'

export default function ResultsPage() {
  return (
    <PlaceholderPage
      title="Results"
      description="How your marketing performed, and what MARKA learned from it."
      icon={TrendingUp}
      hint="After a campaign runs, its results will appear here and feed into MARKA’s future recommendations."
    />
  )
}
