import { Header, HeaderName, Content } from '@carbon/react';

// Placeholder shell. Real screens wait for the user's UI references (D17).
export default function Home() {
  return (
    <>
      <Header aria-label="Orion">
        <HeaderName href="/" prefix="">
          Orion
        </HeaderName>
      </Header>
      <Content>
        <h1 className="cds--type-productive-heading-04">Orion</h1>
        <p>Scaffold is running. Sign-in and settings come next.</p>
      </Content>
    </>
  );
}
