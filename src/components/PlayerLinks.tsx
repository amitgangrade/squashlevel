import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { Player } from '../types'
import { playerAge } from '../lib/format'

/**
 * A player name that links to its public profile page. Falls back to plain
 * text when the player id is unknown (e.g. unresolved match participant).
 */
export function PlayerLink({
  id,
  name,
  className,
}: {
  id: string | null | undefined
  name: string
  className?: string
}) {
  if (!id) return <span className={className}>{name}</span>
  return (
    <Link to={`/players/${id}`} className={clsx('hover:underline', className)}>
      {name}
    </Link>
  )
}

/**
 * Subtitle for a player rendered as discrete chips: club, city, country, age.
 * Each location chip links back to the leaderboard with that filter applied.
 * Returns null when the player has no metadata to show.
 */
export function PlayerMetaLinks({
  player,
  className,
}: {
  player: Pick<Player, 'club' | 'city' | 'country' | 'birthYear'>
  className?: string
}) {
  const age = playerAge(player.birthYear)
  const hasAny = !!(player.club || player.city || player.country || age)
  if (!hasAny) return null
  return (
    <span className={clsx('text-xs text-slate-500', className)}>
      <FilterChips player={player} />
      {age != null && <span className="ml-1">· age {age}</span>}
    </span>
  )
}

function FilterChips({
  player,
}: {
  player: Pick<Player, 'club' | 'city' | 'country'>
}) {
  const parts: React.ReactNode[] = []
  if (player.club) {
    parts.push(
      <Link
        key="club"
        to={`/?club=${encodeURIComponent(player.club)}`}
        className="hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {player.club}
      </Link>,
    )
  }
  if (player.city) {
    parts.push(
      <Link
        key="city"
        to={`/?city=${encodeURIComponent(player.city)}`}
        className="hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {player.city}
      </Link>,
    )
  }
  if (player.country) {
    parts.push(
      <Link
        key="country"
        to={`/?country=${encodeURIComponent(player.country)}`}
        className="hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {player.country}
      </Link>,
    )
  }
  return (
    <>
      {parts.map((node, i) => (
        <span key={i}>
          {i > 0 && <span className="text-slate-400"> · </span>}
          {node}
        </span>
      ))}
    </>
  )
}
