/*
 * CONTACTS LIST PAGE
 * 
 * This page provides a searchable list of all customer contacts across the system.
 * Previously, contacts could only be viewed/managed within individual customer detail pages.
 * This centralizes contact management with search by name, email, or company.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useContacts } from "@/hooks/useContacts";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Mail, Phone, ArrowLeft, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ContactsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    const timer = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
    return () => clearTimeout(timer);
  };

  const { data, isLoading, error } = useContacts({
    search: debouncedSearch || undefined,
    page: 1,
    pageSize: 50,
  });

  // Role check - only internal users can access
  if (user?.role === "customer") {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-4">This page is only available to staff members.</p>
          <Button onClick={() => navigate("/")}>Return Home</Button>
        </div>
      </div>
    );
  }

  const formatDate = (date: Date | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Contacts</h1>
              <p className="text-sm text-muted-foreground">
                Manage all customer contacts across the system
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>All Contacts</CardTitle>
            <CardDescription>
              Search contacts by name, email, or company name
            </CardDescription>
            <div className="flex items-center gap-2 mt-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search contacts by name, email, or company..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9"
                />
              </div>
              {data && (
                <div className="text-sm text-muted-foreground">
                  {data.total} contact{data.total !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                Failed to load contacts. Please try again.
              </div>
            ) : !data || data.contacts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? "No contacts found matching your search." : "No contacts found."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-center">Orders</TableHead>
                    <TableHead className="text-center">Quotes</TableHead>
                    <TableHead>Last Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.contacts.map((contact) => (
                    <TableRow
                      key={contact.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/contacts/${contact.id}`)}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {contact.firstName} {contact.lastName}
                          </span>
                          {contact.title && (
                            <span className="text-xs text-muted-foreground">
                              {contact.title}
                            </span>
                          )}
                          {contact.isPrimary && (
                            <Badge variant="secondary" className="w-fit mt-1 text-xs">
                              Primary
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          <Link
                            href={`/customers/${contact.customerId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {contact.customerName}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        {contact.email ? (
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            <a
                              href={`mailto:${contact.email}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:underline text-sm"
                            >
                              {contact.email}
                            </a>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {contact.phone ? (
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            <a
                              href={`tel:${contact.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:underline text-sm"
                            >
                              {contact.phone}
                            </a>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{contact.ordersCount}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{contact.quotesCount}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(contact.lastActivityAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
