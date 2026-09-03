import { CalendarDays } from 'lucide-react'
import { PlaceholderPage } from './PlaceholderPage'

export default function CalendarPage() {
  return (
    <PlaceholderPage
      title="Calendar"
      description="When each piece of your marketing goes out."
      icon={CalendarDays}
      hint="Scheduled posts from your campaigns will show up on this calendar."
    />
  )
}
