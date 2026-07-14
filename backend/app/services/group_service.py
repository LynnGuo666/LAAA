from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import Client, Group, User
from app.schemas.group import GroupCreate, GroupUpdate


class GroupService:
    """用户组管理服务"""

    @staticmethod
    def create_group(db: Session, group_data: GroupCreate) -> Group:
        """创建用户组"""
        # If setting as default, unset other default groups
        if group_data.is_default:
            db.query(Group).filter(Group.is_default == True).update({'is_default': False})

        group = Group(
            name=group_data.name,
            description=group_data.description,
            is_default=group_data.is_default
        )
        db.add(group)
        db.commit()
        db.refresh(group)
        return group

    @staticmethod
    def get_group(db: Session, group_id: int) -> Optional[Group]:
        """获取用户组"""
        return db.query(Group).filter(Group.id == group_id).first()

    @staticmethod
    def get_group_by_name(db: Session, name: str) -> Optional[Group]:
        """通过名称获取用户组"""
        return db.query(Group).filter(Group.name == name).first()

    @staticmethod
    def list_groups(db: Session, skip: int = 0, limit: int = 100) -> List[Group]:
        """获取用户组列表"""
        return db.query(Group).offset(skip).limit(limit).all()

    @staticmethod
    def update_group(db: Session, group_id: int, group_data: GroupUpdate) -> Optional[Group]:
        """更新用户组"""
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            return None

        # If setting as default, unset other default groups
        if group_data.is_default and not group.is_default:
            db.query(Group).filter(Group.is_default == True).update({'is_default': False})

        update_data = group_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(group, field, value)

        db.commit()
        db.refresh(group)
        return group

    @staticmethod
    def delete_group(db: Session, group_id: int) -> bool:
        """删除用户组"""
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            return False

        db.delete(group)
        db.commit()
        return True

    @staticmethod
    def add_users_to_group(db: Session, group_id: int, user_ids: List[int]) -> Optional[Group]:
        """添加用户到用户组"""
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            return None

        users = db.query(User).filter(User.id.in_(user_ids)).all()
        for user in users:
            if user not in group.users:
                group.users.append(user)

        db.commit()
        db.refresh(group)
        return group

    @staticmethod
    def remove_users_from_group(db: Session, group_id: int, user_ids: List[int]) -> Optional[Group]:
        """从用户组移除用户"""
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            return None

        users = db.query(User).filter(User.id.in_(user_ids)).all()
        for user in users:
            if user in group.users:
                group.users.remove(user)

        db.commit()
        db.refresh(group)
        return group

    @staticmethod
    def set_group_members(db: Session, group_id: int, user_ids: List[int]) -> Optional[Group]:
        """设置用户组成员（覆盖式）"""
        group = db.query(Group).filter(Group.id == group_id).first()
        if not group:
            return None

        users = db.query(User).filter(User.id.in_(user_ids)).all()
        group.users = users

        db.commit()
        db.refresh(group)
        return group

    @staticmethod
    def update_client_access_control(
        db: Session,
        client_id: int,
        allowed_group_ids: List[int],
        denied_group_ids: List[int]
    ) -> Optional[Client]:
        """更新应用的访问控制"""
        client = db.query(Client).filter(Client.id == client_id).first()
        if not client:
            return None

        # 不能同时在白名单和黑名单中
        if set(allowed_group_ids) & set(denied_group_ids):
            raise ValueError("用户组不能同时在允许和禁止列表中")

        allowed_groups = db.query(Group).filter(Group.id.in_(allowed_group_ids)).all() if allowed_group_ids else []
        denied_groups = db.query(Group).filter(Group.id.in_(denied_group_ids)).all() if denied_group_ids else []

        client.allowed_groups = allowed_groups
        client.denied_groups = denied_groups

        db.commit()
        db.refresh(client)
        return client
