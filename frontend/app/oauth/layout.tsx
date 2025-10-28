export default function OAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // OAuth 页面不需要导航栏，直接渲染子组件
  return <>{children}</>;
}
