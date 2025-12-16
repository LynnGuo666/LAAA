from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.schemas import (
    ClientCreate,
    ClientUpdate,
    ClientResponse,
    ClientWithSecretResponse,
    ClientSecretResetResponse
)
from app.schemas.group import ClientAccessControlUpdate
from app.middleware.permission import require_permission
from app.models import User, Client
from app.services.group_service import GroupService
from app.utils.security import generate_random_string, hash_token
import json

router = APIRouter(prefix="/api/clients", tags=["Client Management"])


@router.post("", response_model=ClientWithSecretResponse, status_code=status.HTTP_201_CREATED)
async def create_client(
    client_data: ClientCreate,
    current_user: User = Depends(require_permission('admin.clients')),
    db: Session = Depends(get_db)
):
    """Create a new OAuth client application"""
    # Check email verification
    if not current_user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="创建应用需要先验证邮箱"
        )

    # Generate client_id and client_secret
    client_id = f"client_{generate_random_string(16)}"
    client_secret = generate_random_string(32)

    # Create client
    client = Client(
        client_id=client_id,
        client_secret_hash=hash_token(client_secret),
        name=client_data.name,
        description=client_data.description,
        logo=client_data.logo,
        website_url=getattr(client_data, "website_url", None),
        redirect_uris=json.dumps(client_data.redirect_uris),
        allowed_scopes=json.dumps(client_data.allowed_scopes),
        trusted=client_data.trusted,
        default_access=getattr(client_data, "default_access", False),
        owner_id=current_user.id
    )

    db.add(client)
    db.commit()
    db.refresh(client)

    # Return client with secret (only time it's shown)
    return ClientWithSecretResponse(
        id=client.id,
        client_id=client.client_id,
        client_secret=client_secret,
        name=client.name,
        description=client.description,
        logo=client.logo,
        website_url=client.website_url,
        redirect_uris=json.loads(client.redirect_uris),
        allowed_scopes=json.loads(client.allowed_scopes),
        trusted=client.trusted,
        default_access=bool(client.default_access),
        owner_id=client.owner_id,
        created_at=client.created_at
    )


@router.get("", response_model=List[ClientResponse])
async def list_clients(
    current_user: User = Depends(require_permission('admin.clients')),
    db: Session = Depends(get_db)
):
    """Get list of OAuth clients (admin)"""
    clients = db.query(Client).all()

    result = []
    for client in clients:
        result.append(ClientResponse(
            id=client.id,
            client_id=client.client_id,
            name=client.name,
            description=client.description,
            logo=client.logo,
            website_url=client.website_url,
            redirect_uris=json.loads(client.redirect_uris),
            allowed_scopes=json.loads(client.allowed_scopes),
            trusted=client.trusted,
            default_access=bool(client.default_access),
            owner_id=client.owner_id,
            created_at=client.created_at
        ))

    return result


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: int,
    current_user: User = Depends(require_permission('admin.clients')),
    db: Session = Depends(get_db)
):
    """Get a specific OAuth client (admin)"""
    client = db.query(Client).filter(Client.id == client_id).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    return ClientResponse(
        id=client.id,
        client_id=client.client_id,
        name=client.name,
        description=client.description,
        logo=client.logo,
        website_url=client.website_url,
        redirect_uris=json.loads(client.redirect_uris),
        allowed_scopes=json.loads(client.allowed_scopes),
        trusted=client.trusted,
        default_access=bool(client.default_access),
        owner_id=client.owner_id,
        created_at=client.created_at
    )


@router.put("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: int,
    client_data: ClientUpdate,
    current_user: User = Depends(require_permission('admin.clients')),
    db: Session = Depends(get_db)
):
    """Update an OAuth client (admin)"""
    client = db.query(Client).filter(Client.id == client_id).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # Update fields
    if client_data.name:
        client.name = client_data.name
    if client_data.description is not None:
        client.description = client_data.description
    if client_data.logo is not None:
        client.logo = client_data.logo
    if getattr(client_data, "website_url", None) is not None:
        client.website_url = client_data.website_url
    if client_data.redirect_uris:
        client.redirect_uris = json.dumps(client_data.redirect_uris)
    if client_data.allowed_scopes:
        client.allowed_scopes = json.dumps(client_data.allowed_scopes)
    if client_data.trusted is not None:
        client.trusted = client_data.trusted
    if getattr(client_data, "default_access", None) is not None:
        client.default_access = client_data.default_access

    db.commit()
    db.refresh(client)

    return ClientResponse(
        id=client.id,
        client_id=client.client_id,
        name=client.name,
        description=client.description,
        logo=client.logo,
        website_url=client.website_url,
        redirect_uris=json.loads(client.redirect_uris),
        allowed_scopes=json.loads(client.allowed_scopes),
        trusted=client.trusted,
        default_access=bool(client.default_access),
        owner_id=client.owner_id,
        created_at=client.created_at
    )


@router.delete("/{client_id}")
async def delete_client(
    client_id: int,
    current_user: User = Depends(require_permission('admin.clients')),
    db: Session = Depends(get_db)
):
    """Delete an OAuth client (admin)"""
    client = db.query(Client).filter(Client.id == client_id).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    db.delete(client)
    db.commit()

    return {"message": "Client deleted"}


@router.post("/{client_id}/secret", response_model=ClientSecretResetResponse)
async def reset_client_secret(
    client_id: int,
    current_user: User = Depends(require_permission('admin.clients')),
    db: Session = Depends(get_db)
):
    """Reset client secret (admin)"""
    client = db.query(Client).filter(Client.id == client_id).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # Generate new secret
    new_secret = generate_random_string(32)
    client.client_secret_hash = hash_token(new_secret)

    db.commit()

    return ClientSecretResetResponse(
        client_id=client.client_id,
        client_secret=new_secret
    )


@router.put("/{client_id}/access-control")
async def update_client_access_control(
    client_id: int,
    access_control: ClientAccessControlUpdate,
    current_user: User = Depends(require_permission('admin.clients')),
    db: Session = Depends(get_db)
):
    """更新应用的用户组访问控制"""
    client = db.query(Client).filter(Client.id == client_id).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    try:
        updated_client = GroupService.update_client_access_control(
            db,
            client_id,
            access_control.allowed_group_ids,
            access_control.denied_group_ids
        )

        return {
            "message": "访问控制更新成功",
            "allowed_groups": [{"id": g.id, "name": g.name} for g in updated_client.allowed_groups],
            "denied_groups": [{"id": g.id, "name": g.name} for g in updated_client.denied_groups]
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{client_id}/access-control")
async def get_client_access_control(
    client_id: int,
    current_user: User = Depends(require_permission('admin.clients')),
    db: Session = Depends(get_db)
):
    """获取应用的用户组访问控制"""
    client = db.query(Client).filter(Client.id == client_id).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    return {
        "allowed_groups": [{"id": g.id, "name": g.name} for g in client.allowed_groups],
        "denied_groups": [{"id": g.id, "name": g.name} for g in client.denied_groups]
    }
