import UserProfile from "./UserProfile";
import LogoutButton from "./LogoutButton";

export default function AdminHeader() {
  return (
    <header style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 20px",
      backgroundColor: "#fff",
      boxShadow: "0 2px 6px rgba(0,0,0,0.1)"
    }}>
      <h2>Dashboard</h2>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <UserProfile />
        <LogoutButton />
      </div>
    </header>
  );
}
