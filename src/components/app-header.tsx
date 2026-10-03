'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Header, HeaderGlobalBar, HeaderMenuItem, HeaderName, HeaderNavigation } from '@carbon/react';
import { logoutAction } from '@/app/actions/auth';

// Placeholder shell: plain navigation until the user's UI references arrive (D17).
export function AppHeader({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const path = usePathname();
  const items = [
    { href: '/', label: 'Home' },
    ...(isAdmin
      ? [
          { href: '/users', label: 'Users' },
          { href: '/settings', label: 'Settings' },
        ]
      : []),
    { href: '/account', label: 'Account' },
  ];
  return (
    <Header aria-label="Orion">
      <HeaderName as={Link} href="/" prefix="">
        Orion
      </HeaderName>
      <HeaderNavigation aria-label="Orion">
        {items.map((item) => (
          <HeaderMenuItem key={item.href} as={Link} href={item.href} isActive={path === item.href}>
            {item.label}
          </HeaderMenuItem>
        ))}
      </HeaderNavigation>
      <HeaderGlobalBar>
        <span className="orion-header-user">{name}</span>
        <form action={logoutAction}>
          <button type="submit" className="orion-header-button">Sign out</button>
        </form>
      </HeaderGlobalBar>
    </Header>
  );
}
