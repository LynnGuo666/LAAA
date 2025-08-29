export default function HomePage() {
  return (
    <div className="min-h-full">
      {/* Hero Section */}
      <div className="bg-white">
        <div className="max-w-7xl mx-auto py-16 px-4 sm:py-24 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl sm:tracking-tight lg:text-6xl">
              OAuth 2.0 授权服务器
            </h1>
            <p className="max-w-xl mt-5 mx-auto text-xl text-gray-500">
              安全、可靠的OAuth 2.0和OpenID Connect身份认证与授权服务
            </p>
            <div className="mt-8 flex justify-center space-x-4">
              <a
                href="/login"
                className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                用户登录
              </a>
              <a
                href="/register"
                className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                注册账户
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="bg-gray-50 py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">核心功能</h2>
            <p className="mt-4 text-lg text-gray-500">
              完整实现OAuth 2.0和OpenID Connect规范
            </p>
          </div>
          
          <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* OAuth 2.0 */}
            <div className="bg-white rounded-lg shadow px-6 py-8">
              <div className="text-center">
                <div className="h-12 w-12 mx-auto bg-primary-100 rounded-lg flex items-center justify-center">
                  <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">OAuth 2.0</h3>
                <p className="mt-2 text-sm text-gray-500">
                  支持授权码流程、PKCE、客户端认证等完整OAuth 2.0功能
                </p>
              </div>
            </div>

            {/* OpenID Connect */}
            <div className="bg-white rounded-lg shadow px-6 py-8">
              <div className="text-center">
                <div className="h-12 w-12 mx-auto bg-primary-100 rounded-lg flex items-center justify-center">
                  <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">OpenID Connect</h3>
                <p className="mt-2 text-sm text-gray-500">
                  提供身份认证、用户信息、ID令牌等OIDC标准功能
                </p>
              </div>
            </div>

            {/* Security */}
            <div className="bg-white rounded-lg shadow px-6 py-8">
              <div className="text-center">
                <div className="h-12 w-12 mx-auto bg-primary-100 rounded-lg flex items-center justify-center">
                  <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">安全保障</h3>
                <p className="mt-2 text-sm text-gray-500">
                  JWT签名验证、HTTPS传输、安全的密钥管理
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Documentation */}
      <div className="bg-white py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">开发者资源</h2>
            <p className="mt-4 text-lg text-gray-500">
              快速集成和开发指南
            </p>
            <div className="mt-8 flex justify-center space-x-4">
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
              >
                API文档
              </a>
              <a
                href="/oauth/.well-known/openid_configuration"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                OIDC Discovery
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}