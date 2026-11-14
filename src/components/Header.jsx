import { Link } from 'react-router-dom'

export default function Header() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Link to="/" className="brand">
          Assalamualaikum<span className="brand__tld">.org</span>
        </Link>
      </div>
    </header>
  )
}
