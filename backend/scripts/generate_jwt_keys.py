#!/usr/bin/env python3
"""生成 RS256 JWT 签名密钥对(RSA-2048 PEM)。

用法:
    python scripts/generate_jwt_keys.py [--out-dir ./jwt_keys]

生成的文件:
    jwt_private.pem  — 私钥,签发 token 用,严禁泄露/提交,生产通过 docker secrets 挂载
    jwt_public.pem   — 公钥,经 /.well-known/jwks.json 暴露给 RP 验证 token

然后在 .env 设置:
    JWT_PRIVATE_KEY_PATH=/path/to/jwt_private.pem
    JWT_PUBLIC_KEY_PATH=/path/to/jwt_public.pem
"""
import argparse
import os
import sys

# 允许直接从 backend/ 运行
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.utils.security import generate_rsa_keypair


def main():
    parser = argparse.ArgumentParser(description="生成 RS256 JWT 密钥对")
    parser.add_argument("--out-dir", default="jwt_keys", help="输出目录(默认 ./jwt_keys)")
    args = parser.parse_args()

    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    priv = os.path.join(out_dir, "jwt_private.pem")
    pub = os.path.join(out_dir, "jwt_public.pem")

    if os.path.exists(priv) or os.path.exists(pub):
        print(f"⚠️  目录 {out_dir} 已存在密钥文件,为避免覆盖已退出。", file=sys.stderr)
        print("   如需重新生成,请先删除旧文件。", file=sys.stderr)
        sys.exit(1)

    generate_rsa_keypair(priv, pub)
    os.chmod(priv, 0o600)  # 私钥仅所有者可读写

    print(f"✅ 已生成 RSA-2048 密钥对:")
    print(f"   私钥: {priv}  (chmod 600,严禁提交/泄露)")
    print(f"   公钥: {pub}   (可暴露,JWKS 端点会发布)")
    print()
    print("在 .env 中配置:")
    print(f"   JWT_PRIVATE_KEY_PATH={priv}")
    print(f"   JWT_PUBLIC_KEY_PATH={pub}")


if __name__ == "__main__":
    main()
