from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy.orm import Session, joinedload
from fastapi import HTTPException, status
from app.models import (
    ApplicationPermissionGroup, UserApplicationAccess, User, ClientApplication
)
from app.schemas import PermissionCheckResponse
import json


class PermissionManagementService:
    
    @staticmethod
    def check_user_access(
        db: Session, 
        user_id: str, 
        client_id: str, 
        requested_scopes: List[str]
    ) -> PermissionCheckResponse:
        """检查用户是否有权限使用指定应用的指定作用域"""
        
        # 首先获取应用信息
        client_app = db.query(ClientApplication).filter(
            ClientApplication.client_id == client_id
        ).first()
        
        if not client_app:
            return PermissionCheckResponse(
                has_permission=False,
                allowed_scopes=[],
                denied_scopes=requested_scopes,
                reason="应用不存在",
                requires_approval=False
            )
        
        # 获取应用的权限组
        permission_group = db.query(ApplicationPermissionGroup).filter(
            ApplicationPermissionGroup.client_id == client_app.client_id
        ).first()
        
        # 调试信息
        print(f"DEBUG: Checking permissions for client_id: {client_app.client_id}")
        print(f"DEBUG: Permission group found: {permission_group is not None}")
        
        if not permission_group:
            # 如果没有配置权限组，默认拒绝访问
            print(f"DEBUG: No permission group found for client_id: {client_app.client_id}")
            return PermissionCheckResponse(
                has_permission=False,
                allowed_scopes=[],
                denied_scopes=requested_scopes,
                reason="应用未配置权限组",
                requires_approval=False
            )
        
        # 查找用户的访问记录
        user_access = db.query(UserApplicationAccess).filter(
            UserApplicationAccess.user_id == user_id,
            UserApplicationAccess.client_id == client_app.client_id
        ).first()
        
        # 检查权限是否过期
        if user_access and user_access.expires_at and user_access.expires_at < datetime.utcnow():
            # 权限已过期，删除记录
            db.delete(user_access)
            db.commit()
            user_access = None
        
        # 确定最终的访问权限
        if user_access:
            if user_access.access_type == "denied":
                return PermissionCheckResponse(
                    has_permission=False,
                    allowed_scopes=[],
                    denied_scopes=requested_scopes,
                    reason="用户被明确拒绝访问此应用",
                    requires_approval=False
                )
            elif user_access.access_type == "allowed":
                # 使用用户自定义作用域或组默认作用域
                if user_access.custom_scopes:
                    try:
                        allowed_scopes_list = json.loads(user_access.custom_scopes)
                    except json.JSONDecodeError:
                        allowed_scopes_list = []
                else:
                    try:
                        allowed_scopes_list = json.loads(permission_group.allowed_scopes) if permission_group.allowed_scopes else []
                    except json.JSONDecodeError:
                        allowed_scopes_list = []
                
                # 检查请求的作用域
                final_allowed = []
                denied = []
                
                for scope in requested_scopes:
                    if not allowed_scopes_list or scope in allowed_scopes_list:
                        final_allowed.append(scope)
                    else:
                        denied.append(scope)
                
                return PermissionCheckResponse(
                    has_permission=len(final_allowed) > 0,
                    allowed_scopes=final_allowed,
                    denied_scopes=denied,
                    reason=None if len(final_allowed) > 0 else "请求的作用域不在允许范围内",
                    requires_approval=False
                )
        
        # 没有用户访问记录，使用权限组的默认设置
        if permission_group.default_allowed:
            # 默认允许所有用户
            try:
                allowed_scopes_list = json.loads(permission_group.allowed_scopes) if permission_group.allowed_scopes else []
            except json.JSONDecodeError:
                allowed_scopes_list = []
            
            final_allowed = []
            denied = []
            
            for scope in requested_scopes:
                if not allowed_scopes_list or scope in allowed_scopes_list:
                    final_allowed.append(scope)
                else:
                    denied.append(scope)
            
            return PermissionCheckResponse(
                has_permission=len(final_allowed) > 0,
                allowed_scopes=final_allowed,
                denied_scopes=denied,
                reason=None if len(final_allowed) > 0 else "请求的作用域不在允许范围内",
                requires_approval=False
            )
        else:
            # 默认拒绝
            return PermissionCheckResponse(
                has_permission=False,
                allowed_scopes=[],
                denied_scopes=requested_scopes,
                reason="用户未被授权使用此应用",
                requires_approval=False
            )
    
    @staticmethod
    def create_or_update_permission_group(
        db: Session,
        client_id: str,
        name: str = "默认权限组",
        description: str = None,
        default_allowed: bool = False,
        allowed_scopes: List[str] = None,
        creator_id: str = None
    ) -> ApplicationPermissionGroup:
        """创建或更新应用权限组"""
        
        # 检查是否已存在权限组
        existing_group = db.query(ApplicationPermissionGroup).filter(
            ApplicationPermissionGroup.client_id == client_id
        ).first()
        
        if existing_group:
            # 更新现有权限组
            existing_group.name = name
            existing_group.description = description
            existing_group.default_allowed = default_allowed
            existing_group.allowed_scopes = json.dumps(allowed_scopes) if allowed_scopes else None
            existing_group.updated_at = datetime.utcnow()
            
            db.commit()
            db.refresh(existing_group)
            return existing_group
        else:
            # 创建新权限组
            new_group = ApplicationPermissionGroup(
                client_id=client_id,
                name=name,
                description=description,
                default_allowed=default_allowed,
                allowed_scopes=json.dumps(allowed_scopes) if allowed_scopes else None
            )
            
            db.add(new_group)
            db.commit()
            db.refresh(new_group)
            return new_group
    
    @staticmethod
    def grant_user_access(
        db: Session,
        user_id: str,
        client_id: str,
        access_type: str = "allowed",  # allowed, denied
        custom_scopes: List[str] = None,
        expires_at: datetime = None,
        notes: str = None,
        granted_by: str = None
    ) -> UserApplicationAccess:
        """授予或拒绝用户访问权限"""
        
        # 获取权限组
        permission_group = db.query(ApplicationPermissionGroup).filter(
            ApplicationPermissionGroup.client_id == client_id
        ).first()
        
        if not permission_group:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="应用未配置权限组，请先配置权限组"
            )
        
        # 检查是否已存在访问记录
        existing_access = db.query(UserApplicationAccess).filter(
            UserApplicationAccess.user_id == user_id,
            UserApplicationAccess.client_id == client_id
        ).first()
        
        if existing_access:
            # 更新现有记录
            existing_access.access_type = access_type
            existing_access.custom_scopes = json.dumps(custom_scopes) if custom_scopes else None
            existing_access.expires_at = expires_at
            existing_access.notes = notes
            existing_access.granted_by = granted_by
            existing_access.granted_at = datetime.utcnow()
            existing_access.updated_at = datetime.utcnow()
            
            db.commit()
            db.refresh(existing_access)
            return existing_access
        else:
            # 创建新记录
            new_access = UserApplicationAccess(
                user_id=user_id,
                client_id=client_id,
                permission_group_id=permission_group.id,
                access_type=access_type,
                custom_scopes=json.dumps(custom_scopes) if custom_scopes else None,
                expires_at=expires_at,
                notes=notes,
                granted_by=granted_by
            )
            
            db.add(new_access)
            db.commit()
            db.refresh(new_access)
            return new_access
    
    @staticmethod
    def revoke_user_access(db: Session, user_id: str, client_id: str) -> bool:
        """撤销用户访问权限"""
        access_record = db.query(UserApplicationAccess).filter(
            UserApplicationAccess.user_id == user_id,
            UserApplicationAccess.client_id == client_id
        ).first()
        
        if access_record:
            db.delete(access_record)
            db.commit()
            return True
        
        return False
    
    @staticmethod
    def get_client_permissions(db: Session, client_id: str) -> Dict[str, Any]:
        """获取应用的完整权限配置"""
        # 获取权限组
        permission_group = db.query(ApplicationPermissionGroup).filter(
            ApplicationPermissionGroup.client_id == client_id
        ).first()
        
        # 获取用户访问记录
        user_accesses = db.query(UserApplicationAccess).options(
            joinedload(UserApplicationAccess.user),
            joinedload(UserApplicationAccess.grantor)
        ).filter(UserApplicationAccess.client_id == client_id).all()
        
        return {
            "permission_group": permission_group,
            "user_accesses": user_accesses
        }
    
    @staticmethod
    def get_user_accessible_clients(db: Session, user_id: str) -> List[ClientApplication]:
        """获取用户可以访问的应用列表"""
        # 直接授权的应用
        direct_access = db.query(UserApplicationAccess).options(
            joinedload(UserApplicationAccess.client)
        ).filter(
            UserApplicationAccess.user_id == user_id,
            UserApplicationAccess.access_type == "allowed"
        ).all()
        
        direct_clients = [access.client for access in direct_access]
        
        # 默认允许的应用
        default_allowed_groups = db.query(ApplicationPermissionGroup).options(
            joinedload(ApplicationPermissionGroup.client)
        ).filter(
            ApplicationPermissionGroup.default_allowed == True
        ).all()
        
        default_clients = []
        for group in default_allowed_groups:
            # 检查用户是否被明确拒绝
            denied = db.query(UserApplicationAccess).filter(
                UserApplicationAccess.user_id == user_id,
                UserApplicationAccess.client_id == group.client_id,
                UserApplicationAccess.access_type == "denied"
            ).first()
            
            if not denied:
                default_clients.append(group.client)
        
        # 合并并去重
        all_clients = direct_clients + default_clients
        unique_clients = list({client.id: client for client in all_clients}.values())
        
        return unique_clients