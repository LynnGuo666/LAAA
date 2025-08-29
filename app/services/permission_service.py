from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple
from sqlalchemy.orm import Session, joinedload
from fastapi import HTTPException, status
from app.models import (
    UserApplicationPermission, PermissionRequest, User, ClientApplication
)
from app.schemas import (
    PermissionCreate, PermissionUpdate, PermissionRequestCreate, 
    PermissionRequestUpdate, PermissionCheckResponse
)
import json


class PermissionService:
    
    @staticmethod
    def check_user_permission(
        db: Session, 
        user_id: str, 
        client_id: str, 
        requested_scopes: List[str]
    ) -> PermissionCheckResponse:
        """检查用户是否有权限使用指定应用的指定作用域"""
        
        # 查找用户权限记录
        permission = db.query(UserApplicationPermission).filter(
            UserApplicationPermission.user_id == user_id,
            UserApplicationPermission.client_id == client_id
        ).first()
        
        # 如果没有权限记录，默认需要审批
        if not permission:
            return PermissionCheckResponse(
                has_permission=False,
                allowed_scopes=[],
                denied_scopes=requested_scopes,
                reason="尚未获得应用使用权限",
                requires_approval=True
            )
        
        # 检查是否被明确阻止
        if permission.is_blocked:
            return PermissionCheckResponse(
                has_permission=False,
                allowed_scopes=[],
                denied_scopes=requested_scopes,
                reason="用户已被禁止使用此应用",
                requires_approval=False
            )
        
        # 检查权限是否过期
        if permission.expires_at and permission.expires_at < datetime.utcnow():
            return PermissionCheckResponse(
                has_permission=False,
                allowed_scopes=[],
                denied_scopes=requested_scopes,
                reason="权限已过期",
                requires_approval=True
            )
        
        # 如果没有被明确允许
        if not permission.is_allowed:
            return PermissionCheckResponse(
                has_permission=False,
                allowed_scopes=[],
                denied_scopes=requested_scopes,
                reason="尚未获得应用使用权限",
                requires_approval=True
            )
        
        # 检查具体的作用域权限
        allowed_scopes = []
        denied_scopes = []
        
        # 解析允许的作用域
        permission_allowed_scopes = []
        if permission.allowed_scopes:
            try:
                permission_allowed_scopes = json.loads(permission.allowed_scopes)
            except json.JSONDecodeError:
                permission_allowed_scopes = []
        
        # 解析拒绝的作用域
        permission_denied_scopes = []
        if permission.denied_scopes:
            try:
                permission_denied_scopes = json.loads(permission.denied_scopes)
            except json.JSONDecodeError:
                permission_denied_scopes = []
        
        # 检查每个请求的作用域
        for scope in requested_scopes:
            if scope in permission_denied_scopes:
                denied_scopes.append(scope)
            elif not permission_allowed_scopes or scope in permission_allowed_scopes:
                # 如果没有限制作用域或明确允许该作用域
                allowed_scopes.append(scope)
            else:
                denied_scopes.append(scope)
        
        has_permission = len(allowed_scopes) > 0
        
        return PermissionCheckResponse(
            has_permission=has_permission,
            allowed_scopes=allowed_scopes,
            denied_scopes=denied_scopes,
            reason=None if has_permission else "部分权限被拒绝",
            requires_approval=False
        )
    
    @staticmethod
    def create_permission(db: Session, permission: PermissionCreate, approver_id: str) -> UserApplicationPermission:
        """创建或更新用户权限"""
        
        # 检查是否已存在权限记录
        existing = db.query(UserApplicationPermission).filter(
            UserApplicationPermission.user_id == permission.user_id,
            UserApplicationPermission.client_id == permission.client_id
        ).first()
        
        if existing:
            # 更新现有权限
            existing.is_allowed = permission.is_allowed
            existing.is_blocked = permission.is_blocked
            existing.allowed_scopes = json.dumps(permission.allowed_scopes) if permission.allowed_scopes else None
            existing.denied_scopes = json.dumps(permission.denied_scopes) if permission.denied_scopes else None
            existing.approval_reason = permission.approval_reason
            existing.expires_at = permission.expires_at
            existing.approved_by = approver_id
            existing.approved_at = datetime.utcnow()
            existing.updated_at = datetime.utcnow()
            
            db.commit()
            db.refresh(existing)
            return existing
        else:
            # 创建新权限记录
            new_permission = UserApplicationPermission(
                user_id=permission.user_id,
                client_id=permission.client_id,
                is_allowed=permission.is_allowed,
                is_blocked=permission.is_blocked,
                allowed_scopes=json.dumps(permission.allowed_scopes) if permission.allowed_scopes else None,
                denied_scopes=json.dumps(permission.denied_scopes) if permission.denied_scopes else None,
                approval_reason=permission.approval_reason,
                expires_at=permission.expires_at,
                approved_by=approver_id,
                approved_at=datetime.utcnow()
            )
            
            db.add(new_permission)
            db.commit()
            db.refresh(new_permission)
            return new_permission
    
    @staticmethod
    def get_user_permissions(db: Session, user_id: str) -> List[UserApplicationPermission]:
        """获取用户的所有权限"""
        return db.query(UserApplicationPermission).options(
            joinedload(UserApplicationPermission.client),
            joinedload(UserApplicationPermission.approver)
        ).filter(UserApplicationPermission.user_id == user_id).all()
    
    @staticmethod
    def get_client_permissions(db: Session, client_id: str) -> List[UserApplicationPermission]:
        """获取应用的所有用户权限"""
        return db.query(UserApplicationPermission).options(
            joinedload(UserApplicationPermission.user),
            joinedload(UserApplicationPermission.approver)
        ).filter(UserApplicationPermission.client_id == client_id).all()
    
    @staticmethod
    def create_permission_request(
        db: Session, 
        user_id: str, 
        request: PermissionRequestCreate
    ) -> PermissionRequest:
        """创建权限申请"""
        
        # 检查是否已有待处理的申请
        existing = db.query(PermissionRequest).filter(
            PermissionRequest.user_id == user_id,
            PermissionRequest.client_id == request.client_id,
            PermissionRequest.status == "pending"
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="已有待处理的权限申请"
            )
        
        # 创建新申请
        new_request = PermissionRequest(
            user_id=user_id,
            client_id=request.client_id,
            requested_scopes=json.dumps(request.requested_scopes),
            request_reason=request.request_reason
        )
        
        db.add(new_request)
        db.commit()
        db.refresh(new_request)
        return new_request
    
    @staticmethod
    def process_permission_request(
        db: Session,
        request_id: str,
        update: PermissionRequestUpdate,
        reviewer_id: str
    ) -> PermissionRequest:
        """处理权限申请"""
        
        permission_request = db.query(PermissionRequest).filter(
            PermissionRequest.id == request_id
        ).first()
        
        if not permission_request:
            raise HTTPException(status_code=404, detail="权限申请不存在")
        
        if permission_request.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="权限申请已被处理"
            )
        
        # 更新申请状态
        permission_request.status = update.status
        permission_request.review_reason = update.review_reason
        permission_request.reviewed_by = reviewer_id
        permission_request.reviewed_at = datetime.utcnow()
        
        # 如果批准，自动创建权限记录
        if update.status == "approved":
            try:
                requested_scopes = json.loads(permission_request.requested_scopes)
            except json.JSONDecodeError:
                requested_scopes = []
            
            permission_data = PermissionCreate(
                user_id=permission_request.user_id,
                client_id=permission_request.client_id,
                is_allowed=True,
                is_blocked=False,
                allowed_scopes=requested_scopes,
                approval_reason=f"通过申请审批: {update.review_reason or ''}"
            )
            
            PermissionService.create_permission(db, permission_data, reviewer_id)
        
        db.commit()
        db.refresh(permission_request)
        return permission_request
    
    @staticmethod
    def get_pending_requests(db: Session, limit: int = 50) -> List[PermissionRequest]:
        """获取待处理的权限申请"""
        return db.query(PermissionRequest).options(
            joinedload(PermissionRequest.user),
            joinedload(PermissionRequest.client)
        ).filter(PermissionRequest.status == "pending").limit(limit).all()
    
    @staticmethod
    def revoke_permission(db: Session, user_id: str, client_id: str, revoker_id: str) -> bool:
        """撤销用户权限"""
        permission = db.query(UserApplicationPermission).filter(
            UserApplicationPermission.user_id == user_id,
            UserApplicationPermission.client_id == client_id
        ).first()
        
        if permission:
            permission.is_allowed = False
            permission.is_blocked = True
            permission.approved_by = revoker_id
            permission.approved_at = datetime.utcnow()
            permission.approval_reason = "权限已被撤销"
            
            db.commit()
            return True
        
        return False