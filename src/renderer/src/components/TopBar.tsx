import { useStore } from '../state/store'

export default function TopBar(): JSX.Element {
  const { screen } = useStore()
  return <header className="topbar">{screen}</header>
}