import { LayoutGrid } from 'lucide-react'
import { PlaceholderPage } from './PlaceholderPage'

export default function OverviewPage() {
  return (
    <PlaceholderPage
      title="Overview"
      description="A calm summary of what EVA is working on for your business."
      icon={LayoutGrid}
      hint="Once you run your first campaign, a short summary of what is live and what is coming up will appear here."
    />
  )
}
