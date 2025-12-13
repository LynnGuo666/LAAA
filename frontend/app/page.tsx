import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8 text-center">
        <h1 className="text-6xl font-bold">OAuth 服务器</h1>
        <p className="text-xl text-gray-600">
          个人 OAuth 2.0 认证授权服务器
        </p>

        <div className="flex gap-4 justify-center pt-8">
          <Link href="/login" className="btn btn-primary">
            登录
          </Link>
          <Link href="/register" className="btn btn-secondary">
            邀请码注册
          </Link>
        </div>

        <div className="pt-12 text-sm text-gray-500">
          <p>为你的应用提供安全的认证和授权服务</p>
        </div>
      </div>
    </main>
  );
}
