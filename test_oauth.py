#!/usr/bin/env python3
"""
测试LAAA Dashboard OAuth登录流程
"""

import requests
import json
from urllib.parse import parse_qs, urlparse

# 配置
BASE_URL = "http://localhost:8000"
CLIENT_ID = "0ad8034b58e35484f23c163be2648580"
REDIRECT_URI = f"{BASE_URL}/callback"
USERNAME = "admin"
PASSWORD = "admin123"

def test_oauth_flow():
    session = requests.Session()
    
    print("🧪 开始测试OAuth授权流程...")
    print("=" * 50)
    
    # 1. 发起授权请求
    print("1. 发起OAuth授权请求...")
    auth_params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "openid profile email",
        "state": "dashboard_login"
    }
    
    auth_response = session.get(f"{BASE_URL}/oauth/authorize", params=auth_params, allow_redirects=True)
    print(f"   状态码: {auth_response.status_code}")
    
    # 检查是否被重定向到登录页面
    if auth_response.url.endswith('/login') or '/login?' in auth_response.url:
        print(f"   ✅ 重定向到登录页面: {auth_response.url}")
        
        # 2. 模拟前端登录页面的POST请求到授权端点
        print("\n2. 提交用户凭据进行授权...")
        login_data = {
            "username": USERNAME,
            "password": PASSWORD,
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid profile email",
            "state": "dashboard_login",
            "consent": True
        }
        
        # 发送到授权处理端点
        auth_post_response = session.post(f"{BASE_URL}/oauth/authorize", data=login_data, allow_redirects=True)
        print(f"   状态码: {auth_post_response.status_code}")
        
        # 检查最终URL，看是否是回调URL
        final_url = auth_post_response.url
        print(f"   最终URL: {final_url}")
        
        if '/callback' in final_url:
            # 解析授权码
            parsed_url = urlparse(final_url)
            query_params = parse_qs(parsed_url.query)
            
            if 'code' in query_params:
                auth_code = query_params['code'][0]
                print(f"   ✅ 获取授权码: {auth_code[:20]}...")
                
                # 3. 用授权码换取令牌
                print("\n3. 使用授权码换取访问令牌...")
                token_data = {
                    "grant_type": "authorization_code",
                    "code": auth_code,
                    "redirect_uri": REDIRECT_URI,
                    "client_id": CLIENT_ID
                }
                
                token_response = session.post(f"{BASE_URL}/oauth/token", data=token_data)
                print(f"   状态码: {token_response.status_code}")
                
                if token_response.status_code == 200:
                    tokens = token_response.json()
                    print(f"   ✅ 获取访问令牌: {tokens['access_token'][:20]}...")
                    print(f"   令牌类型: {tokens['token_type']}")
                    print(f"   过期时间: {tokens['expires_in']}秒")
                    
                    # 4. 使用访问令牌获取用户信息
                    print("\n4. 使用访问令牌获取用户信息...")
                    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
                    userinfo_response = session.get(f"{BASE_URL}/oauth/userinfo", headers=headers)
                    print(f"   状态码: {userinfo_response.status_code}")
                    
                    if userinfo_response.status_code == 200:
                        userinfo = userinfo_response.json()
                        print(f"   ✅ 用户信息获取成功:")
                        print(f"      用户ID: {userinfo.get('sub')}")
                        print(f"      用户名: {userinfo.get('preferred_username')}")
                        print(f"      邮箱: {userinfo.get('email')}")
                        
                        print("\n🎉 OAuth流程测试成功！")
                        return True
                    else:
                        print(f"   ❌ 用户信息获取失败: {userinfo_response.text}")
                else:
                    print(f"   ❌ 令牌交换失败: {token_response.text}")
            elif 'error' in query_params:
                error = query_params['error'][0]
                error_desc = query_params.get('error_description', [''])[0]
                print(f"   ❌ 授权失败: {error}")
                print(f"   错误描述: {error_desc}")
            else:
                print(f"   ❌ 无效的回调URL参数: {query_params}")
        else:
            print(f"   ❌ 授权请求失败，未重定向到回调URL: {final_url}")
            if auth_post_response.text:
                print(f"   响应内容: {auth_post_response.text[:200]}...")
    else:
        print(f"   ❌ 初始授权请求失败: {auth_response.text}")
    
    return False

if __name__ == "__main__":
    try:
        success = test_oauth_flow()
        if not success:
            print("\n💥 测试失败！请检查服务器日志。")
    except Exception as e:
        print(f"\n💥 测试出现异常: {e}")