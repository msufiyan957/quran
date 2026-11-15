import { Link } from 'react-router-dom'

export default function Header() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Link to="/" className="brand">
          <span className="brand__name">Assalamualaikum.org</span>
        </Link>
      </div>
    </header>
  )
}
