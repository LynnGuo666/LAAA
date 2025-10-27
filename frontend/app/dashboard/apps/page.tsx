'use client';

import { useEffect, useState } from 'react';
import { clientApi } from '@/lib/api';

interface Client {
  id: number;
  client_id: string;
  name: string;
  description?: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  trusted: boolean;
  created_at: string;
}

export default function AppsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    redirect_uris: '',
    allowed_scopes: 'profile email',
    trusted: false,
  });

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const response = await clientApi.list();
      setClients(response.data);
    } catch (err) {
      console.error('Failed to load clients', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await clientApi.create({
        name: formData.name,
        description: formData.description || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter(u => u.trim()),
        allowed_scopes: formData.allowed_scopes.split(' ').filter(s => s.trim()),
        trusted: formData.trusted,
      });

      alert(`App created!\n\nClient ID: ${response.data.client_id}\nClient Secret: ${response.data.client_secret}\n\nSave the secret now, it won't be shown again!`);

      setShowCreateForm(false);
      setFormData({
        name: '',
        description: '',
        redirect_uris: '',
        allowed_scopes: 'profile email',
        trusted: false,
      });
      loadClients();
    } catch (err: any) {
      alert('Failed to create app: ' + (err.response?.data?.detail || 'Unknown error'));
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete app "${name}"?`)) return;

    try {
      await clientApi.delete(id);
      loadClients();
    } catch (err) {
      alert('Failed to delete app');
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">My Applications</h1>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="btn btn-primary"
        >
          {showCreateForm ? 'Cancel' : '+ Create App'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="card mb-8 space-y-4">
          <h2 className="text-xl font-semibold">Create New Application</h2>

          <div>
            <label className="block text-sm font-medium mb-2">App Name *</label>
            <input
              type="text"
              required
              className="input"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea
              className="input"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Redirect URIs * (one per line)</label>
            <textarea
              required
              className="input font-mono text-sm"
              rows={3}
              placeholder="http://localhost:3000/callback&#10;https://myapp.com/callback"
              value={formData.redirect_uris}
              onChange={(e) => setFormData({ ...formData, redirect_uris: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Allowed Scopes (space-separated)</label>
            <input
              type="text"
              className="input"
              value={formData.allowed_scopes}
              onChange={(e) => setFormData({ ...formData, allowed_scopes: e.target.value })}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="trusted"
              checked={formData.trusted}
              onChange={(e) => setFormData({ ...formData, trusted: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="trusted" className="ml-2 text-sm">
              Trusted app (skip authorization prompt)
            </label>
          </div>

          <button type="submit" className="btn btn-primary">
            Create Application
          </button>
        </form>
      )}

      <div className="space-y-4">
        {clients.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">No applications yet. Create one to get started!</p>
          </div>
        ) : (
          clients.map((client) => (
            <div key={client.id} className="card">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">{client.name}</h3>
                  {client.description && (
                    <p className="text-sm text-gray-600 mt-1">{client.description}</p>
                  )}
                  <div className="mt-3 space-y-1 text-sm">
                    <p>
                      <span className="font-medium">Client ID:</span>{' '}
                      <code className="bg-gray-100 px-2 py-1 rounded">{client.client_id}</code>
                    </p>
                    <p>
                      <span className="font-medium">Scopes:</span> {client.allowed_scopes.join(', ')}
                    </p>
                    {client.trusted && (
                      <p className="text-green-600">✓ Trusted application</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(client.id, client.name)}
                  className="btn btn-danger text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
